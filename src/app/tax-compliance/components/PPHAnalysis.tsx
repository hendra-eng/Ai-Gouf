'use client';
import React from 'react';

import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';

const PPH_ITEMS = [
  { id: 'pph21', type: 'PPh 21', description: 'Employee income tax withholding', current: 38_400_000, previous: 37_200_000, outstanding: 38_400_000, status: 'Due Soon' },
  { id: 'pph23', type: 'PPh 23', description: 'Withholding tax on services & royalties', current: 12_800_000, previous: 11_600_000, outstanding: 12_800_000, status: 'Due Soon' },
  { id: 'pph25', type: 'PPh 25', description: 'Monthly corporate income tax installment', current: 36_600_000, previous: 35_200_000, outstanding: 36_600_000, status: 'Ready to File' },
  { id: 'pph29', type: 'PPh 29', description: 'Annual corporate income tax settlement', current: 0, previous: 0, outstanding: 0, status: 'Not Due' },
];

const STATUS_STYLES: Record<string, string> = {
  'Due Soon': 'bg-warning-subtle text-warning',
  'Ready to File': 'bg-info-subtle text-info',
  'Paid': 'bg-positive-subtle text-positive',
  'Not Due': 'bg-muted text-muted-foreground',
  'Overdue': 'bg-negative-subtle text-negative',
};

export default function PPHAnalysis() {
  const { fx } = useCurrency();
  const goToObligation = () => {
    document.getElementById('tax-obligations')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-lg font-600 text-foreground">PPh Analysis</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Pajak Penghasilan · Aug 2026</p>
        </div>
        <span className="text-xs font-600 text-warning bg-warning-subtle px-2.5 py-1 rounded-full border border-warning/20">
          {fx(formatIDR(38_400_000 + 12_800_000 + 36_600_000, true))} Outstanding
        </span>
      </div>

      <div className="space-y-3">
        {PPH_ITEMS.map((item) => {
          const change = item.previous > 0 ? ((item.current - item.previous) / item.previous) * 100 : 0;
          const isUp = change >= 0;
          return (
            <div key={item.id} onClick={goToObligation} className="rounded-xl border border-border p-4 hover:border-primary/30 transition-colors cursor-pointer group">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-700 text-foreground">{item.type}</span>
                    <span className={`text-2xs font-600 px-1.5 py-0.5 rounded-full ${STATUS_STYLES[item.status]}`}>
                      {item.status}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-base font-700 font-tabular text-foreground">
                    {item.current > 0 ? fx(formatIDR(item.current, true)) : '—'}
                  </p>
                  {item.previous > 0 && (
                    <p className={`text-2xs font-500 font-tabular ${isUp ? 'text-negative' : 'text-positive'}`}>
                      {isUp ? '▲' : '▼'} {Math.abs(change).toFixed(1)}% vs prev
                    </p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-3 border-t border-border">
                <div>
                  <p className="text-2xs text-muted-foreground">Current Period</p>
                  <p className="text-xs font-600 font-tabular text-foreground">{item.current > 0 ? fx(formatIDR(item.current, true)) : '—'}</p>
                </div>
                <div>
                  <p className="text-2xs text-muted-foreground">Previous Period</p>
                  <p className="text-xs font-600 font-tabular text-muted-foreground">{item.previous > 0 ? fx(formatIDR(item.previous, true)) : '—'}</p>
                </div>
                <div>
                  <p className="text-2xs text-muted-foreground">Outstanding</p>
                  <p className={`text-xs font-600 font-tabular ${item.outstanding > 0 ? 'text-warning' : 'text-positive'}`}>
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
