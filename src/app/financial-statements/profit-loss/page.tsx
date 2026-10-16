import React from 'react';
import ProfitLossClient from '../components/fs/ProfitLossClient';

export const metadata = {
  title: 'Profit & Loss — zafeb',
  description: 'Statement of profit or loss from the posted General Ledger.',
};

export default function ProfitLossPage() {
  return <ProfitLossClient />;
}
