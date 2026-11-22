import React from 'react';
import TrialBalanceClient from './components/TrialBalanceClient';

export const metadata = {
  title: 'Trial Balance — Reports — zafeb',
  description: 'Opening balance, monthly movements, and ending balances by account.',
};

export default function TrialBalancePage() {
  return <TrialBalanceClient />;
}
