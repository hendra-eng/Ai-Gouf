import React from 'react';
import CashFlowClient from '../components/fs/CashFlowClient';

export const metadata = {
  title: 'Cash Flow Statement — FinovaAI',
  description: 'Indirect-method cash flow from the General Ledger and cash flow mapping.',
};

export default function CashFlowPage() {
  return <CashFlowClient />;
}
