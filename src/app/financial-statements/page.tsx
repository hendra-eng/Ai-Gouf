import React from 'react';
import FsHubClient from './components/fs/FsHubClient';

export const metadata = {
  title: 'Financial Statements — FinovaAI',
  description: 'Balance sheet, profit and loss, changes in equity, cash flow and notes built from the posted General Ledger.',
};

export default function FinancialStatementsPage() {
  return <FsHubClient />;
}
