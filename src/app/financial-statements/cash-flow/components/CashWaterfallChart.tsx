'use client';
import React from 'react';
import dynamic from 'next/dynamic';
import type { CFWaterfallEntry } from './CashWaterfallChartInner';

const CashWaterfallChartInner = dynamic(
  () => import('./CashWaterfallChartInner'),
  {
    ssr: false,
    loading: () => <div className="h-[260px] w-full rounded-lg bg-slate-50 animate-pulse" />,
  }
);

export default function CashWaterfallChart({
  data,
  fx,
}: {
  data: CFWaterfallEntry[];
  fx: (v: number) => string;
}) {
  return <CashWaterfallChartInner data={data} fx={fx} />;
}
