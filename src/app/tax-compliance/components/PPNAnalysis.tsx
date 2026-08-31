'use client';
import React from 'react';
import dynamic from 'next/dynamic';

import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';

const PPNChartInner = dynamic(() => import('./PPNChartInner'), { ssr: false, loading: () => (
  <div className="h-48 animate-pulse bg-muted rounded-xl" />
) });

export default function PPNAnalysis() {
  const { fx } = useCurrency();
  const outputVAT = 142_700_000;
  const inputVAT = 48_500_000;
  const vatPayable = outputVAT - inputVAT;

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-lg font-600 text-foreground">PPN Analysis</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Pajak Pertambahan Nilai · Aug 2026</p>
        </div>
        <span className="text-xs font-600 text-warning bg-warning-subtle px-2.5 py-1 rounded-full border border-warning/20">
          Payable: {fx(formatIDR(vatPayable, true))}
        </span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: 'Output VAT', value: outputVAT, color: 'text-negative', sub: 'From sales' },
          { label: 'Input VAT', value: inputVAT, color: 'text-positive', sub: 'From purchases' },
          { label: 'Net VAT Payable', value: vatPayable, color: 'text-warning', sub: 'Output - Input' },
        ]?.map((item) => (
          <div key={`ppn-${item?.label}`} className="bg-muted rounded-xl p-3 text-center">
            <p className="text-2xs text-muted-foreground mb-1">{item?.label}</p>
            <p className={`text-base font-700 font-tabular ${item?.color}`}>{fx(formatIDR(item?.value, true))}</p>
            <p className="text-2xs text-muted-foreground mt-0.5">{item?.sub}</p>
          </div>
        ))}
      </div>

      <PPNChartInner />

      <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          <span className="font-500 text-foreground">Reconciliation Status:</span> Tax records match accounting records
        </div>
        <span className="text-xs font-600 text-positive bg-positive-subtle px-2 py-0.5 rounded-full">Reconciled</span>
      </div>
    </div>
  );
}
