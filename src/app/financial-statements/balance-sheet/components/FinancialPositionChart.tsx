'use client';
import React from 'react';
import dynamic from 'next/dynamic';
import type { BSMonthlyRow } from '../../lib/useBalanceSheetData';

const FinancialPositionChartInner = dynamic(
  () => import('./FinancialPositionChartInner'),
  {
    ssr: false,
    loading: () => <div className="h-[240px] w-full rounded-lg bg-slate-50 animate-pulse" />,
  }
);

export default function FinancialPositionChart({
  data,
  fx,
}: {
  data: BSMonthlyRow[];
  fx: (v: number) => string;
}) {
  return <FinancialPositionChartInner data={data} fx={fx} />;
}