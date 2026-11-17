import React from 'react';
import FxRevaluationClient from './components/FxRevaluationClient';

export const metadata = {
  title: 'FX Revaluation — zafeb',
  description: 'Period-end revaluation of open foreign-currency invoices and bills with automatic reversal.',
};

export default function FxRevaluationPage() {
  return <React.Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading...</div>}><FxRevaluationClient /></React.Suspense>;
}
