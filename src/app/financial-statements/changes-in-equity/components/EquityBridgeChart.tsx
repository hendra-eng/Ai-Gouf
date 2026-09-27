'use client';
import React from 'react';
import dynamic from 'next/dynamic';
import { useEquityStatement } from '../../lib/useStatementData';

const Inner = dynamic(() => import('./EquityBridgeChartInner'), { ssr: false });

export default function EquityBridgeChart() {
  // Data dari API /api/v1/financial-statements (transaksi posted), satuan juta.
  const { summary: s, periodLabel } = useEquityStatement();
  return (
    <Inner
      periodLabel={periodLabel}
      values={{ opening: s.openingEquity, capital: s.capitalContributions, profit: s.netProfit, dividends: s.dividends, adjustments: s.otherAdjustments }}
    />
  );
}
