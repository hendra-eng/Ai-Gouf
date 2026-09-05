'use client';
import React from 'react';
import dynamic from 'next/dynamic';

const Inner = dynamic(() => import('./EquityBridgeChartInner'), { ssr: false });

export default function EquityBridgeChart() {
  return <Inner />;
}