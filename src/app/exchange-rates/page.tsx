import React from 'react';
import ExchangeRatesClient from './components/ExchangeRatesClient';

export const metadata = {
  title: 'Exchange Rates — zafeb',
  description: 'Master of exchange rates against IDR: manual entry, spreadsheet paste and automatic fetch.',
};

export default function ExchangeRatesPage() {
  return <React.Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading...</div>}><ExchangeRatesClient /></React.Suspense>;
}
