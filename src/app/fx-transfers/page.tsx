import React from 'react';
import FxTransfersClient from './components/FxTransfersClient';

export const metadata = {
  title: 'FX Transfers — zafeb',
  description: 'Foreign-currency bank accounts and transfers between accounts of different currencies.',
};

export default function FxTransfersPage() {
  return <React.Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading...</div>}><FxTransfersClient /></React.Suspense>;
}
