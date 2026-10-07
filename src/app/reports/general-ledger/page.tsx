import React, { Suspense } from 'react';
import GeneralLedgerClient from './components/GeneralLedgerClient';

export const metadata = {
  title: 'General Ledger — Reports — FinovaAI',
  description: 'Account-level postings with opening, running, and closing balances.',
};

export default function GeneralLedgerPage() {
  // Suspense wajib karena GeneralLedgerClient membaca useSearchParams (drill-down dari Financial Statements).
  return (
    <Suspense fallback={null}>
      <GeneralLedgerClient />
    </Suspense>
  );
}
