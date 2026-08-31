'use client';
import React from 'react';
import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/LoadingSkeleton';

const ARAgingDonutInner = dynamic(() => import('./ARAgingDonutInner'), {
  ssr: false,
  loading: () => (
    <div className="card-elevated-md rounded-xl p-5 h-full">
      <Skeleton className="h-5 w-40 mb-4" />
      <Skeleton className="h-48 w-48 rounded-full mx-auto" />
    </div>
  ),
});

export default function ARAgingDonut() {
  return <ARAgingDonutInner />;
}
