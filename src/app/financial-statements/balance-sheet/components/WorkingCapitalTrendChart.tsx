'use client';
import React from 'react';
import dynamic from 'next/dynamic';
import type { WorkingCapitalRow } from './WorkingCapitalTrendChartInner';

const WorkingCapitalTrendChartInner = dynamic(
  () => import('./WorkingCapitalTrendChartInner'),
  {
    ssr: false,
    loading: () => <div className="h-[180px] w-full rounded-lg bg-slate-50 animate-pulse" />,
  }
);

export default function WorkingCapitalTrendChart({
  data,
  fx,
}: {
  data: WorkingCapitalRow[];
  fx: (v: number) => string;
}) {
  return <WorkingCapitalTrendChartInner data={data} fx={fx} />;
}
