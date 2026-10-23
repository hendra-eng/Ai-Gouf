
import React from 'react';
import OtherTransactionForm from '../components/OtherTransactionForm';

export const metadata = {
  title: 'Create Other Transaction — zafeb',
  description: 'Record a special business event from a template: the journal entry is generated automatically.',
};

export default function CreateOtherTransactionPage() {
  return <React.Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading...</div>}><OtherTransactionForm /></React.Suspense>;
}
