import React from 'react';
import OtherWorkspace from './components/OtherWorkspace';

export const metadata = {
  title: 'Other Transactions — zafeb',
  description: 'Special business events outside Sales, Purchase and Cash & Bank: templates, review, and posting to the General Ledger.',
};

export default function OtherTransactionsPage() {
  return <React.Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading...</div>}><OtherWorkspace /></React.Suspense>;
}
