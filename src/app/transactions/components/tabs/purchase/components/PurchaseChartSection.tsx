'use client';
import React from 'react';
import dynamic from 'next/dynamic';

const PurchaseBarChart = dynamic(() => import('./PurchaseBarChart'), { ssr: false });

const vendorBreakdown = [
  { id: 'vend-01', name: 'Synergy Systems Inc.', amount: '$48,200', pct: 100, category: 'Technology' },
  { id: 'vend-02', name: 'CoreSupply Partners', amount: '$36,800', pct: 76, category: 'Raw Materials' },
  { id: 'vend-03', name: 'Nexus Office Solutions', amount: '$24,100', pct: 50, category: 'Office Supplies' },
  { id: 'vend-04', name: 'Atlas Freight Services', amount: '$19,600', pct: 41, category: 'Logistics' },
  { id: 'vend-05', name: 'Pinnacle Cloud Ltd.', amount: '$16,400', pct: 34, category: 'Cloud Services' },
  { id: 'vend-06', name: 'Delta Engineering Co.', amount: '$12,900', pct: 27, category: 'Engineering' },
];

export default function PurchaseChartSection() {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="xl:col-span-2 bg-card rounded-xl border border-border p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-600 text-foreground">Purchase Trend by Category</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Monthly spend breakdown — FY 2026</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-primary inline-block" />
              Technology
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block" />
              Materials
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />
              Services
            </span>
          </div>
        </div>
        <PurchaseBarChart />
      </div>
      <div className="bg-card rounded-xl border border-border p-5 shadow-sm">
        <h3 className="text-sm font-600 text-foreground mb-1">Top Vendors</h3>
        <p className="text-xs text-muted-foreground mb-4">By spend — Sep 2026</p>
        <div className="space-y-3">
          {vendorBreakdown?.map((v, i) => (
            <div key={`top-vendor-${v?.id}`} className="flex items-center gap-3">
              <span className="text-xs font-600 text-muted-foreground w-4 text-right">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs font-500 text-foreground truncate">{v?.name}</span>
                  <span className="text-xs font-600 text-foreground font-tabular ml-2">{v?.amount}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-muted rounded-full h-1.5">
                    <div className="h-1.5 rounded-full bg-primary" style={{ width: `${v?.pct}%` }} />
                  </div>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">{v?.category}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}