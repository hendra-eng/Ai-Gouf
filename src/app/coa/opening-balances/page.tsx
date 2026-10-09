import React from 'react';
import OpeningBalanceListClient from './components/OpeningBalanceListClient';

export const metadata = {
  title: 'Opening Balances — Chart of Accounts — FinovaAI',
  description: 'Starting balances per fiscal year and branch, posted as an opening journal.',
};

export default function OpeningBalancesPage() {
  return <OpeningBalanceListClient />;
}
