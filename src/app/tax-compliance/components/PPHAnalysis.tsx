'use client';
import React from 'react';

import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';
import { useTaxComplianceData } from '../lib/taxBridge';

const DESCRIPTIONS: Record<string, string> = {
  'PPh 21': 'Employee income tax withholding',
  'PPh 23': 'Withholding tax on services & royalties',
  'PPh 25': 'Monthly corporate income tax installment',
  'PPh 29': 'Annual corporate income tax settlement',
};

const STATUS_STYLES: Record<string, string> = {
  'Due Soon': 'bg-warning-subtle text-warning',
  'Ready to File': 'bg-info-subtle text-info',
  'Calculated': 'bg-info-subtle text-info',
  'Draft': 'bg-muted text-muted-foreground',
  'Paid': 'bg-positive-subtle text-positive',
  'Not Due': 'bg-muted text-muted-foreground',
  'Overdue': 'bg-negative-subtle text-negative',
};

export default function PPHAnalysis() {
  const { fx } = useCurrency();
  const { byType } = useTaxComplianceData();
  const items = byType.map((t) => ({
    id: t.taxType.toLowerCase().replace(/\s+/g, ''),
    type: t.taxType,
    description: DESCRIPTIONS[t.taxType],
    current: t.current,
    previous: t.previous,
    outstanding: t.outstanding,
    status: t.current > 0 ? t.status : 'Not Due',
  }));
  const totalOutstanding = items.reduce((s, i) => s + i.outstanding, 0);

  const goToObligation = () => {
    document.getElementById('tax-obligations')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-lg font-semibold text-foreground">PPh Analysis</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Pajak Penghasilan · Latest posted period</p>
        </div>
        <span className="text-xs font-semibold text-warning bg-warning-subtle px-2.5 py-1 rounded-full border border-warning/20">
          {fx(formatIDR(totalOutstanding, true))} Outstanding
        </span>
      </div>

      <div className="space-y-3">
        {items.map((item) => {
          const change = item.previous > 0 ? ((item.current - item.previous) / item.previous) * 100 : 0;
          const isUp = change >= 0;
          return (
            <div key={item.id} onClick={goToObligation} className="rounded-xl border border-border p-4 hover:border-primary/30 transition-colors cursor-pointer group">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-bold text-foreground">{item.type}</span>
                    <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded-full ${STATUS_STYLES[item.status] || 'bg-muted text-muted-foreground'}`}>
                      {item.status}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-base font-bold tabular-nums text-foreground">
                    {item.current > 0 ? fx(formatIDR(item.current, true)) : '—'}
                  </p>
                  {item.previous > 0 && (
                    <p className={`text-2xs font-medium tabular-nums ${isUp ? 'text-negative' : 'text-positive'}`}>
                      {isUp ? '▲' : '▼'} {Math.abs(change).toFixed(1)}% vs prev
                    </p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-3 border-t border-border">
                <div>
                  <p className="text-2xs text-muted-foreground">Current Period</p>
                  <p className="text-xs font-semibold tabular-nums text-foreground">{item.current > 0 ? fx(formatIDR(item.current, true)) : '—'}</p>
                </div>
                <div>
                  <p className="text-2xs text-muted-foreground">Previous Period</p>
                  <p className="text-xs font-semibold tabular-nums text-muted-foreground">{item.previous > 0 ? fx(formatIDR(item.previous, true)) : '—'}</p>
                </div>
                <div>
                  <p className="text-2xs text-muted-foreground">Outstanding</p>
                  <p className={`text-xs font-semibold tabular-nums ${item.outstanding > 0 ? 'text-warning' : 'text-positive'}`}>
                    {item.outstanding > 0 ? fx(formatIDR(item.outstanding, true)) : 'None'}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
