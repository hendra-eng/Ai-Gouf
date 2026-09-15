'use client';
import React from 'react';
import dynamic from 'next/dynamic';

const SalesAreaChart = dynamic(() => import('./SalesAreaChart'), { ssr: false });

const topCustomers = [
  { id: 'cust-01', name: 'Meridian Tech Solutions', amount: '$42,800', pct: 100 },
  { id: 'cust-02', name: 'Apex Manufacturing Co.', amount: '$36,150', pct: 84 },
  { id: 'cust-03', name: 'Horizon Retail Group', amount: '$28,400', pct: 66 },
  { id: 'cust-04', name: 'Cascade Logistics Ltd.', amount: '$21,960', pct: 51 },
  { id: 'cust-05', name: 'Pinnacle Healthcare', amount: '$18,200', pct: 43 },
  { id: 'cust-06', name: 'Summit Capital Group', amount: '$14,750', pct: 34 },
];

export default function SalesChartSection() {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="xl:col-span-2 bg-card rounded-xl border border-border p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-600 text-foreground">Monthly Sales Trend</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Revenue by payment status — FY 2026</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-primary inline-block" />
              Paid
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block" />
              Outstanding
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-red-400 inline-block" />
              Overdue
            </span>
          </div>
        </div>
        <SalesAreaChart />
      </div>
      <div className="bg-card rounded-xl border border-border p-5 shadow-sm">
        <h3 className="text-sm font-600 text-foreground mb-1">Top Customers</h3>
        <p className="text-xs text-muted-foreground mb-4">By revenue — Sep 2026</p>
        <div className="space-y-3">
          {topCustomers?.map((c, i) => (
            <div key={`top-cust-${c?.id}`} className="flex items-center gap-3">
              <span className="text-xs font-600 text-muted-foreground w-4 text-right">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-500 text-foreground truncate">{c?.name}</span>
                  <span className="text-xs font-600 text-foreground font-tabular ml-2">{c?.amount}</span>
                </div>
                <div className="w-full bg-muted rounded-full h-1.5">
                  <div
                    className="h-1.5 rounded-full bg-primary"
                    style={{ width: `${c?.pct}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}