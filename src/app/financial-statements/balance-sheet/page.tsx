import React from 'react';
import BalanceSheetClient from '../components/fs/BalanceSheetClient';

export const metadata = {
  title: 'Balance Sheet — zafeb',
  description: 'Statement of financial position from the General Ledger and COA mapping.',
};

export default function BalanceSheetPage() {
  return <BalanceSheetClient />;
}
