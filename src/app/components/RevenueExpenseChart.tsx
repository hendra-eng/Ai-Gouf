'use client';
import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/LoadingSkeleton';

const RevenueExpenseChartInner = dynamic(
  () => import('./RevenueExpenseChartInner'),
  {
    ssr: false,
    loading: () => (
      <div className="card-elevated-md rounded-xl p-5">
        <Skeleton className="h-5 w-56 mb-4" />
        <Skeleton className="h-[300px] w-full rounded-lg" />
      </div>
    ),
  }
);

export default function RevenueExpenseChart() {
  return <RevenueExpenseChartInner />;
}
