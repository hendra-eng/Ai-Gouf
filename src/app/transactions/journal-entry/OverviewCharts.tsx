'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/LoadingSkeleton';

const EntryTrendChart = dynamic(() => import('./charts/EntryTrendChart'), {
  ssr: false,
  loading: () => <Skeleton className="h-56 w-full" />,
});

const StatusDistributionChart = dynamic(() => import('./charts/StatusDistributionChart'), {
  ssr: false,
  loading: () => <Skeleton className="h-56 w-full" />,
});

const ExceptionBreakdownChart = dynamic(() => import('./charts/ExceptionBreakdownChart'), {
  ssr: false,
  loading: () => <Skeleton className="h-56 w-full" />,
});

export default function OverviewCharts() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-3 gap-6">
      {/* Entry Volume Trend — spans 2 cols */}
      <div className="lg:col-span-2 je-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-700 text-foreground">Journal Entry Volume</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Last 30 days — entries created vs posted</p>
          </div>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-md">Last 30 days</span>
        </div>
        <EntryTrendChart />
      </div>

      {/* Status Distribution */}
      <div className="je-card p-5">
        <div className="mb-4">
          <h2 className="text-sm font-700 text-foreground">Entry Status Distribution</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Sep 2026 · 42 total entries</p>
        </div>
        <StatusDistributionChart />
      </div>

      {/* Exception Breakdown */}
      <div className="lg:col-span-3 je-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-700 text-foreground">Exception Breakdown by Type</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Open exceptions requiring resolution before period close</p>
          </div>
          <button className="text-xs text-primary font-600 hover:underline">View All Exceptions →</button>
        </div>
        <ExceptionBreakdownChart />
      </div>
    </div>
  );
}